package main

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"

	"go.bug.st/serial/enumerator"
)

// Espressif USB VID
const espressifVID = "303A"

// Known Espressif PIDs
var espressifPIDs = map[string]string{
	"1001": "ESP32-C3/S3/C6/H2 USB-JTAG-Serial",
	"0002": "ESP32-S2/S3 USB-OTG (TinyUSB)",
}

// Common USB-UART bridge chips used on ESP32 dev boards
var uartBridgeVIDs = map[string]string{
	"10C4": "Silicon Labs CP210x",
	"1A86": "QinHeng CH340",
	"0403": "FTDI",
}

type detectedPort struct {
	Name        string
	Description string
	IsESP       bool
}

// detectPorts scans for USB serial ports and identifies Espressif devices.
// If a specific port is requested, it validates that port exists.
func detectPorts() ([]detectedPort, error) {
	ports, err := enumerator.GetDetailedPortsList()
	if err != nil {
		return nil, fmt.Errorf("enumerate serial ports: %w", err)
	}

	var found []detectedPort
	for _, p := range ports {
		if !p.IsUSB {
			continue
		}

		dp := detectedPort{Name: p.Name}

		// Check for native Espressif USB
		if p.VID == espressifVID {
			if desc, ok := espressifPIDs[p.PID]; ok {
				dp.Description = desc
			} else {
				dp.Description = fmt.Sprintf("Espressif (PID %s)", p.PID)
			}
			dp.IsESP = true
			found = append(found, dp)
			continue
		}

		// Check for common USB-UART bridges
		if desc, ok := uartBridgeVIDs[p.VID]; ok {
			dp.Description = desc
			dp.IsESP = true // likely an ESP dev board
			found = append(found, dp)
			continue
		}

		// Unknown USB serial device
		dp.Description = fmt.Sprintf("USB Serial (VID %s, PID %s)", p.VID, p.PID)
		found = append(found, dp)
	}

	return found, nil
}

// findPort returns the best serial port to use.
// If portFlag is set, it validates that port exists.
// Otherwise, it auto-detects an Espressif device.
func findPort(portFlag string) (string, error) {
	if portFlag != "" {
		// User specified a port explicitly, trust them
		return portFlag, nil
	}

	// Auto-detect
	detected, err := detectPorts()
	if err != nil {
		return "", err
	}

	// Prefer native Espressif USB devices
	var espPorts []detectedPort
	for _, p := range detected {
		if p.IsESP {
			espPorts = append(espPorts, p)
		}
	}

	switch len(espPorts) {
	case 0:
		if len(detected) == 0 {
			return "", fmt.Errorf("no USB serial ports found")
		}
		return "", fmt.Errorf("no ESP device detected. Available ports:\n%s", formatPorts(detected))
	case 1:
		return espPorts[0].Name, nil
	default:
		return promptPortSelection(espPorts)
	}
}

// promptPortSelection displays a numbered menu and reads the user's choice from stdin.
func promptPortSelection(ports []detectedPort) (string, error) {
	fmt.Println()
	fmt.Println("Multiple ESP devices found")
	fmt.Println("----------------------------------------")
	for i, p := range ports {
		fmt.Printf("[%d] %s  (%s)\n", i+1, p.Name, p.Description)
	}
	fmt.Println("----------------------------------------")

	reader := bufio.NewReader(os.Stdin)
	for {
		fmt.Printf("Select port (1-%d): ", len(ports))

		line, err := reader.ReadString('\n')
		if err != nil {
			return "", fmt.Errorf("read input: %w", err)
		}

		line = strings.TrimSpace(line)
		n, err := strconv.Atoi(line)
		if err != nil || n < 1 || n > len(ports) {
			fmt.Println("\nInvalid selection!")
			continue
		}
		return ports[n-1].Name, nil
	}
}

func formatPorts(ports []detectedPort) string {
	var s string
	for _, p := range ports {
		s += fmt.Sprintf("  %s  (%s)\n", p.Name, p.Description)
	}
	return s
}
