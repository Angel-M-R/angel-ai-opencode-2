package main

import (
	"path/filepath"
	"testing"
)

func TestDefaultConfigDirPrecedence(t *testing.T) {
	for _, tc := range []struct{ override, xdg, want string }{
		{"/custom", "/xdg", "/custom"}, {"", "/xdg", filepath.Join("/xdg", "opencode")}, {"", "", filepath.Join("/home", ".config", "opencode")},
	} {
		t.Run(tc.want, func(t *testing.T) {
			t.Setenv("OPENCODE_CONFIG_DIR", tc.override)
			t.Setenv("XDG_CONFIG_HOME", tc.xdg)
			if got := defaultConfigDir("/home"); got != tc.want {
				t.Fatalf("got %q want %q", got, tc.want)
			}
		})
	}
}
