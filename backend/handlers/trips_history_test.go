package handlers

import "testing"

func TestParseTripsLimit(t *testing.T) {
	tests := []struct {
		name    string
		in      string
		want    int
		wantErr bool
	}{
		{"empty is default", "", 50, false},
		{"min", "1", 1, false},
		{"middle", "50", 50, false},
		{"max", "100", 100, false},
		{"zero", "0", 0, true},
		{"over max", "101", 0, true},
		{"negative", "-1", 0, true},
		{"plus sign", "+5", 0, true},
		{"letters", "abc", 0, true},
		{"decimal", "1.5", 0, true},
		{"leading space", " 5", 0, true},
		{"huge", "99999999999999999999", 0, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseTripsLimit(tt.in)
			if (err != nil) != tt.wantErr {
				t.Fatalf("err = %v, wantErr %v", err, tt.wantErr)
			}
			if got != tt.want {
				t.Fatalf("got %d, want %d", got, tt.want)
			}
		})
	}
}
