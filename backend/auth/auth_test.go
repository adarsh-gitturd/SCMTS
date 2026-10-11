package auth

import (
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const testSecret = "test-secret-that-is-at-least-32-chars!"

func setup(t *testing.T) {
	t.Helper()
	if err := SetSecret(testSecret); err != nil {
		t.Fatal(err)
	}
}

func TestSetSecretTooShort(t *testing.T) {
	if err := SetSecret("short"); err == nil {
		t.Fatal("expected error for short secret")
	}
}

func TestHashAndCheck(t *testing.T) {
	h, err := HashPassword("correct horse")
	if err != nil {
		t.Fatal(err)
	}
	if !CheckPassword(h, "correct horse") {
		t.Error("right password rejected")
	}
	if CheckPassword(h, "wrong horse") {
		t.Error("wrong password accepted")
	}
}

func TestTokenRoundTrip(t *testing.T) {
	setup(t)
	tok, err := NewToken(42, "driver")
	if err != nil {
		t.Fatal(err)
	}
	c, err := ParseToken(tok)
	if err != nil {
		t.Fatal(err)
	}
	if c.UserID != 42 || c.Role != "driver" {
		t.Errorf("got uid=%d role=%q", c.UserID, c.Role)
	}
	if d := time.Until(c.ExpiresAt.Time); d < 23*time.Hour || d > 24*time.Hour {
		t.Errorf("unexpected expiry in %v", d)
	}
}

func signWith(t *testing.T, m jwt.SigningMethod, key any, exp time.Time) string {
	t.Helper()
	c := Claims{UserID: 1, Role: "admin", RegisteredClaims: jwt.RegisteredClaims{ExpiresAt: jwt.NewNumericDate(exp)}}
	s, err := jwt.NewWithClaims(m, c).SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestExpiredTokenRejected(t *testing.T) {
	setup(t)
	tok := signWith(t, jwt.SigningMethodHS256, []byte(testSecret), time.Now().Add(-time.Minute))
	if _, err := ParseToken(tok); err == nil {
		t.Fatal("expired token accepted")
	}
}

func TestTamperedTokenRejected(t *testing.T) {
	setup(t)
	tok, err := NewToken(5, "student")
	if err != nil {
		t.Fatal(err)
	}
	// Swap the payload for one claiming admin, keeping the original signature.
	parts := strings.Split(tok, ".")
	forged := strings.Split(signWith(t, jwt.SigningMethodHS256, []byte("another-secret-also-32-chars-long!!"), time.Now().Add(time.Hour)), ".")
	if _, err := ParseToken(parts[0] + "." + forged[1] + "." + parts[2]); err == nil {
		t.Fatal("tampered payload accepted")
	}
	// Token signed with a different key.
	if _, err := ParseToken(strings.Join(forged, ".")); err == nil {
		t.Fatal("token with wrong key accepted")
	}
}

func TestWrongAlgorithmRejected(t *testing.T) {
	setup(t)
	exp := time.Now().Add(time.Hour)
	hs512 := signWith(t, jwt.SigningMethodHS512, []byte(testSecret), exp)
	if _, err := ParseToken(hs512); err == nil {
		t.Error("HS512 token accepted")
	}
	none := signWith(t, jwt.SigningMethodNone, jwt.UnsafeAllowNoneSignatureType, exp)
	if _, err := ParseToken(none); err == nil {
		t.Error(`alg "none" token accepted`)
	}
}
