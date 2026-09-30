package install_test

import (
	"os"
	"testing"
)

func writeExecutable(t *testing.T, path, content string) {
	t.Helper()
	write(t, path, content)
	if err := os.Chmod(path, 0o755); err != nil {
		t.Fatal(err)
	}
}

func readFile(t *testing.T, path string) []byte {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func anyStrings(values []any) []string {
	result := make([]string, len(values))
	for index, value := range values {
		result[index], _ = value.(string)
	}
	return result
}
