// openneato-flash flashes OpenNeato firmware to an ESP32 and opens
// a serial monitor for first-time WiFi configuration.
//
// Plug in the device and run:
//
//	openneato-flash
//
// The tool auto-detects the chip type, downloads the matching firmware
// from the latest GitHub release, flashes it, and opens a serial monitor
// for WiFi setup.
package main

import (
	"flag"
	"fmt"
	"os"
)

func main() {
	port := flag.String("port", "", "Serial port (auto-detected if not set)")
	chip := flag.String("chip", "", "Chip type (auto-detected, e.g. esp32-c3, esp32-s3)")
	firmwarePack := flag.String("firmware", "", "Path to local firmware pack .tar.gz (skips download)")
	listPorts := flag.Bool("list", false, "List available serial ports")
	noMonitor := flag.Bool("no-monitor", false, "Skip serial monitor after flashing")
	monitorOnly := flag.Bool("monitor", false, "Open serial monitor without flashing")
	showVersion := flag.Bool("version", false, "Print version and exit")

	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "openneato-flash - Flash and configure OpenNeato firmware\n\n")
		fmt.Fprintf(os.Stderr, "Usage:\n")
		fmt.Fprintf(os.Stderr, "  openneato-flash                    Auto-detect chip, download and flash latest firmware\n")
		fmt.Fprintf(os.Stderr, "  openneato-flash -chip esp32-c3     Skip chip detection, use specified chip\n")
		fmt.Fprintf(os.Stderr, "  openneato-flash -firmware pack.tar.gz  Flash from local firmware pack\n")
		fmt.Fprintf(os.Stderr, "  openneato-flash -monitor           Open serial monitor only\n\n")
		fmt.Fprintf(os.Stderr, "Options:\n")
		flag.PrintDefaults()
	}

	flag.Parse()

	if *showVersion {
		fmt.Printf("openneato-flash %s\n", version)
		return
	}

	if *listPorts {
		ports, err := detectPorts()
		if err != nil {
			fatal("Failed to list ports: %v", err)
		}
		if len(ports) == 0 {
			fmt.Println("No USB serial ports found.")
			return
		}
		fmt.Println("Available serial ports:")
		for _, p := range ports {
			marker := " "
			if p.IsESP {
				marker = "*"
			}
			fmt.Printf("  %s %s  (%s)\n", marker, p.Name, p.Description)
		}
		return
	}

	// Find serial port
	portName, err := findPort(*port)
	if err != nil {
		fatal("%v", err)
	}
	fmt.Printf("Using port: %s\n", portName)

	// Flash (unless monitor-only)
	if !*monitorOnly {
		// Ensure esptool is available
		esptoolPath, err := ensureEsptool()
		if err != nil {
			fatal("%v", err)
		}

		// Resolve firmware directory
		var fwDir string
		if *firmwarePack != "" {
			// Extract local tarball
			fwDir, err = extractLocalPack(*firmwarePack)
			if err != nil {
				fatal("Extract firmware pack: %v", err)
			}
			defer func() { _ = os.RemoveAll(fwDir) }()
		} else {
			// Need to know the chip to download firmware
			chipName := *chip
			if chipName == "" {
				fmt.Println("Detecting chip type...")
				chipName, err = detectChip(esptoolPath, portName)
				if err != nil {
					fatal("%v\nUse -chip to specify manually (e.g. -chip esp32-c3)", err)
				}
				fmt.Printf("Detected chip: %s\n", chipName)
			}

			// Download firmware pack from latest release
			fwDir, err = downloadFirmwarePack(chipName)
			if err != nil {
				fatal("%v", err)
			}
			defer func() { _ = os.RemoveAll(fwDir) }()
		}

		if err := flashFirmware(portName, esptoolPath, fwDir); err != nil {
			fatal("%v", err)
		}
		fmt.Println("Flash complete!")
	}

	// Monitor
	if !*noMonitor {
		if !*monitorOnly {
			fmt.Println("\nOpening serial monitor for WiFi setup...")
		}
		if err := openMonitor(portName); err != nil {
			fatal("Monitor error: %v", err)
		}
	}
}

func fatal(format string, args ...interface{}) {
	fmt.Fprintf(os.Stderr, "Error: "+format+"\n", args...)
	os.Exit(1)
}
