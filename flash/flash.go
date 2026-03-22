package main

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// Set via -ldflags at build time by GoReleaser.
// Defaults are for local development builds.
var (
	version        = "dev"
	esptoolVersion = "dev"
)

type flashOffsets struct {
	Bootloader string `json:"bootloader"`
	Partitions string `json:"partitions"`
	OTAData    string `json:"otadata"`
	App        string `json:"app"`
}

// progressReader wraps an io.Reader and prints download progress.
type progressReader struct {
	r       io.Reader
	total   int64
	current int64
	lastPct int
}

func (pr *progressReader) Read(p []byte) (int, error) {
	n, err := pr.r.Read(p)
	pr.current += int64(n)
	pct := int(float64(pr.current) / float64(pr.total) * 100)
	if pct != pr.lastPct {
		pr.lastPct = pct
		bar := pct / 2
		fmt.Printf("\r  [%-50s] %d%%", strings.Repeat("#", bar)+strings.Repeat(".", 50-bar), pct)
	}
	return n, err
}

// --- esptool management ---

// ensureEsptool returns the path to the pinned esptool version,
// downloading it if not already cached.
func ensureEsptool() (string, error) {
	cached := cachedEsptoolPath()
	if _, err := os.Stat(cached); err == nil {
		return cached, nil
	}

	return downloadEsptool()
}

func cachedEsptoolPath() string {
	cacheDir, _ := os.UserCacheDir()
	name := "esptool"
	if runtime.GOOS == "windows" {
		name = "esptool.exe"
	}
	return filepath.Join(cacheDir, "openneato", esptoolVersion, name)
}

func downloadEsptool() (string, error) {
	url, err := esptoolDownloadURL()
	if err != nil {
		return "", err
	}
	if url == "" {
		return "", fmt.Errorf("no esptool binary available for %s/%s", runtime.GOOS, runtime.GOARCH)
	}

	dest := cachedEsptoolPath()
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return "", err
	}

	return downloadAndExtract(url, dest, "esptool")
}

func resolveEsptoolVersion() (string, error) {
	if esptoolVersion != "dev" {
		return esptoolVersion, nil
	}
	// Dev builds: query GitHub API for latest esptool release tag
	resp, err := http.Get("https://api.github.com/repos/espressif/esptool/releases/latest") //nolint:gosec
	if err != nil {
		return "", fmt.Errorf("fetch latest esptool version: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	var release struct {
		TagName string `json:"tag_name"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil || release.TagName == "" {
		return "", fmt.Errorf("parse esptool release: %w", err)
	}
	return release.TagName, nil
}

func esptoolDownloadURL() (string, error) {
	v, err := resolveEsptoolVersion()
	if err != nil {
		return "", err
	}
	base := fmt.Sprintf("https://github.com/espressif/esptool/releases/download/%s/esptool-%s", v, v)
	switch runtime.GOOS + "/" + runtime.GOARCH {
	case "darwin/arm64":
		return base + "-macos-arm64.tar.gz", nil
	case "darwin/amd64":
		return base + "-macos-amd64.tar.gz", nil
	case "linux/amd64":
		return base + "-linux-amd64.tar.gz", nil
	case "linux/arm64":
		return base + "-linux-aarch64.tar.gz", nil
	case "windows/amd64":
		return base + "-windows-amd64.zip", nil
	default:
		return "", nil
	}
}

// --- Chip detection ---

// detectChip runs esptool to identify the connected chip type.
// Returns the lowercased chip name (e.g. "esp32-c3") matching release asset naming.
func detectChip(esptoolPath, portName string) (string, error) {
	cmd := exec.Command(esptoolPath, "-p", portName, "chip-id") //nolint:gosec
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("chip detection failed: %w\n%s", err, out)
	}

	// Parse "Detecting chip type... ESP32-C3" from esptool output
	const prefix = "Detecting chip type... "
	for _, line := range strings.Split(string(out), "\n") {
		if idx := strings.Index(line, prefix); idx >= 0 {
			chip := strings.TrimSpace(line[idx+len(prefix):])
			if chip != "" {
				return strings.ToLower(chip), nil
			}
		}
	}

	return "", fmt.Errorf("could not detect chip type from esptool output:\n%s", out)
}

// --- Checksum verification ---

// parseChecksums parses a GoReleaser-format checksums.txt file and returns
// a map of filename -> lowercase hex SHA-256 hash.
// Each line has the format: "<sha256>  <filename>"
func parseChecksums(data string) map[string]string {
	result := make(map[string]string)
	for _, line := range strings.Split(data, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// GoReleaser uses "hash  filename" (two spaces)
		parts := strings.SplitN(line, "  ", 2)
		if len(parts) != 2 {
			continue
		}
		hash := strings.TrimSpace(parts[0])
		name := strings.TrimSpace(parts[1])
		if hash != "" && name != "" {
			result[name] = strings.ToLower(hash)
		}
	}
	return result
}

// sha256File computes the SHA-256 hash of a file and returns it as a lowercase hex string.
func sha256File(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer func() { _ = f.Close() }()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// verifyChecksum looks up the expected hash for filename in the checksums map
// and compares it against the actual file on disk.
func verifyChecksum(checksums map[string]string, filename, filePath string) error {
	expected, ok := checksums[filename]
	if !ok {
		return fmt.Errorf("checksums.txt does not contain an entry for %s", filename)
	}

	fmt.Printf("Verifying SHA-256 checksum of %s...\n", filename)
	actual, err := sha256File(filePath)
	if err != nil {
		return fmt.Errorf("compute checksum: %w", err)
	}

	if actual != expected {
		return fmt.Errorf("checksum mismatch for %s:\n  expected: %s\n  got:      %s", filename, expected, actual)
	}

	fmt.Println("Checksum OK.")
	return nil
}

// --- Download helper ---

// downloadToFile downloads a URL to a local file, showing a progress bar.
// Returns an error on non-200 status or network failure.
func downloadToFile(url, dest string) error {
	resp, err := http.Get(url) //nolint:gosec
	if err != nil {
		return fmt.Errorf("download %s: %w", url, err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download %s: HTTP %d", url, resp.StatusCode)
	}

	f, err := os.OpenFile(dest, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()

	body := io.Reader(resp.Body)
	if resp.ContentLength > 0 {
		fmt.Printf("  (%.1f MB)\n", float64(resp.ContentLength)/1024/1024)
		body = &progressReader{r: resp.Body, total: resp.ContentLength}
	}

	if _, err := io.Copy(f, body); err != nil {
		return err
	}
	fmt.Printf("\r  [%-50s] 100%%\n", strings.Repeat("#", 50))
	return nil
}

// --- Firmware download ---

// downloadFirmwarePack downloads the board-specific firmware tarball from
// the latest GitHub release and extracts it into a temp directory.
// It also downloads checksums.txt and verifies the archive integrity.
// Returns the path to the temp directory containing the extracted files.
func downloadFirmwarePack(chip string) (string, error) {
	var baseURL, archiveName string
	archiveName = fmt.Sprintf("openneato-%s-full.tar.gz", chip)
	if version == "dev" {
		baseURL = "https://github.com/renjfk/OpenNeato/releases/latest/download"
	} else {
		baseURL = fmt.Sprintf("https://github.com/renjfk/OpenNeato/releases/download/v%s", version)
	}

	archiveURL := baseURL + "/" + archiveName
	checksumsURL := baseURL + "/checksums.txt"

	fmt.Printf("Downloading firmware %s for %s...\n", version, chip)

	// Download checksums.txt first
	checksums, err := downloadChecksums(checksumsURL)
	if err != nil {
		return "", fmt.Errorf("download checksums: %w", err)
	}

	// Download archive to a temp file so we can verify before extracting
	tmpFile, err := os.CreateTemp("", "openneato-*.tar.gz")
	if err != nil {
		return "", err
	}
	tmpFilePath := tmpFile.Name()
	_ = tmpFile.Close()
	defer func() { _ = os.Remove(tmpFilePath) }()

	if err := downloadToFile(archiveURL, tmpFilePath); err != nil {
		return "", fmt.Errorf("firmware: %w", err)
	}

	// Verify checksum
	if err := verifyChecksum(checksums, archiveName, tmpFilePath); err != nil {
		return "", err
	}

	// Extract verified archive
	tmp, err := os.MkdirTemp("", "openneato-firmware-*")
	if err != nil {
		return "", err
	}

	archiveFile, err := os.Open(tmpFilePath)
	if err != nil {
		_ = os.RemoveAll(tmp)
		return "", err
	}
	defer func() { _ = archiveFile.Close() }()

	if err := extractAllTarGz(archiveFile, tmp); err != nil {
		_ = os.RemoveAll(tmp)
		return "", fmt.Errorf("extract firmware: %w", err)
	}

	return tmp, nil
}

// downloadChecksums fetches checksums.txt from the given URL and parses it.
func downloadChecksums(url string) (map[string]string, error) {
	resp, err := http.Get(url) //nolint:gosec
	if err != nil {
		return nil, fmt.Errorf("fetch checksums.txt: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetch checksums.txt: HTTP %d", resp.StatusCode)
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read checksums.txt: %w", err)
	}

	checksums := parseChecksums(string(data))
	if len(checksums) == 0 {
		return nil, fmt.Errorf("checksums.txt is empty or has no valid entries")
	}

	return checksums, nil
}

// --- Flashing ---

// flashFirmware invokes esptool to flash the firmware pack at the given dir.
func flashFirmware(portName, esptoolPath, firmwareDir string) error {
	offsetsPath := filepath.Join(firmwareDir, "offsets.json")
	data, err := os.ReadFile(offsetsPath)
	if err != nil {
		return fmt.Errorf("read offsets.json: %w", err)
	}

	var offsets flashOffsets
	if err := json.Unmarshal(data, &offsets); err != nil {
		return fmt.Errorf("parse offsets: %w", err)
	}

	type image struct {
		offset string
		name   string
	}

	images := []image{
		{offsets.Bootloader, "bootloader.bin"},
		{offsets.Partitions, "partitions.bin"},
		{offsets.OTAData, "boot_app0.bin"},
		{offsets.App, "firmware.bin"},
	}

	args := []string{
		"-p", portName,
		"-b", "921600",
		"--before", "default-reset",
		"--after", "hard-reset",
		"write-flash", "-z",
	}

	for _, img := range images {
		path := filepath.Join(firmwareDir, img.name)
		info, err := os.Stat(path)
		if err != nil {
			return fmt.Errorf("missing %s in firmware pack", img.name)
		}
		fmt.Printf("  %s: %d bytes at %s\n", img.name, info.Size(), img.offset)
		args = append(args, img.offset, path)
	}

	fmt.Printf("Flashing via %s...\n", esptoolPath)

	cmd := exec.Command(esptoolPath, args...) //nolint:gosec
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("esptool failed: %w", err)
	}

	return nil
}

// --- Archive helpers ---

func downloadAndExtract(url, dest, binaryName string) (string, error) {
	fmt.Printf("Downloading %s...\n", binaryName)

	tmp, err := os.CreateTemp("", "openneato-dl-*")
	if err != nil {
		return "", err
	}
	tmpPath := tmp.Name()
	_ = tmp.Close()
	defer func() { _ = os.Remove(tmpPath) }()

	if err := downloadToFile(url, tmpPath); err != nil {
		return "", err
	}

	f, err := os.Open(tmpPath)
	if err != nil {
		return "", err
	}
	defer func() { _ = f.Close() }()

	winName := binaryName + ".exe"
	if strings.HasSuffix(url, ".zip") {
		err = extractZipBinary(f, dest, winName)
	} else {
		err = extractTarGzBinary(f, dest, binaryName)
	}
	if err != nil {
		return "", err
	}
	return dest, nil
}

func extractTarGzBinary(r io.Reader, dest, binaryName string) error {
	gz, err := gzip.NewReader(r)
	if err != nil {
		return err
	}
	defer func() { _ = gz.Close() }()

	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		if filepath.Base(hdr.Name) == binaryName && hdr.Typeflag == tar.TypeReg {
			f, err := os.OpenFile(dest, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
			if err != nil {
				return err
			}
			_, err = io.Copy(f, tr) //nolint:gosec
			_ = f.Close()
			return err
		}
	}
	return fmt.Errorf("%s not found in archive", binaryName)
}

func extractZipBinary(r io.Reader, dest, binaryName string) error {
	tmp, err := os.CreateTemp("", "esptool-*.zip")
	if err != nil {
		return err
	}
	defer func() {
		_ = tmp.Close()
		_ = os.Remove(tmp.Name())
	}()

	size, err := io.Copy(tmp, r)
	if err != nil {
		return err
	}

	zr, err := zip.NewReader(tmp, size)
	if err != nil {
		return err
	}

	for _, f := range zr.File {
		if filepath.Base(f.Name) == binaryName {
			rc, err := f.Open()
			if err != nil {
				return err
			}
			out, err := os.OpenFile(dest, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
			if err != nil {
				_ = rc.Close()
				return err
			}
			_, err = io.Copy(out, rc) //nolint:gosec
			_ = rc.Close()
			_ = out.Close()
			return err
		}
	}
	return fmt.Errorf("%s not found in archive", binaryName)
}

func extractAllTarGz(r io.Reader, destDir string) error {
	gz, err := gzip.NewReader(r)
	if err != nil {
		return err
	}
	defer func() { _ = gz.Close() }()

	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		if hdr.Typeflag != tar.TypeReg {
			continue
		}
		dest := filepath.Join(destDir, filepath.Base(hdr.Name))
		f, err := os.OpenFile(dest, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
		if err != nil {
			return err
		}
		_, err = io.Copy(f, tr) //nolint:gosec
		_ = f.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

// extractLocalPack extracts a local .tar.gz firmware pack into a temp directory.
// It expects checksums.txt to exist in the same directory as the archive and
// verifies the archive's SHA-256 checksum before extraction.
func extractLocalPack(path string) (string, error) {
	// Verify checksum from checksums.txt in the same directory
	archiveDir := filepath.Dir(path)
	archiveName := filepath.Base(path)
	checksumsPath := filepath.Join(archiveDir, "checksums.txt")

	data, err := os.ReadFile(checksumsPath)
	if err != nil {
		return "", fmt.Errorf("checksums.txt not found next to %s: %w\nPlace the checksums.txt from the GitHub release in the same directory", archiveName, err)
	}

	checksums := parseChecksums(string(data))
	if len(checksums) == 0 {
		return "", fmt.Errorf("checksums.txt is empty or has no valid entries")
	}

	if err := verifyChecksum(checksums, archiveName, path); err != nil {
		return "", err
	}

	// Extract verified archive
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer func() { _ = f.Close() }()

	tmp, err := os.MkdirTemp("", "openneato-firmware-*")
	if err != nil {
		return "", err
	}

	if err := extractAllTarGz(f, tmp); err != nil {
		_ = os.RemoveAll(tmp)
		return "", err
	}

	return tmp, nil
}
