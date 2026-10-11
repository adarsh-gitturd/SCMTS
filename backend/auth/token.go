package auth

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// TokenTTL is how long a login token stays valid.
const TokenTTL = 24 * time.Hour

// MinSecretLen is the shortest JWT secret accepted.
const MinSecretLen = 32

// Set once at startup by SetSecret.
var secret []byte

// Claims is the JWT payload: user id, role and expiry.
type Claims struct {
	UserID int64  `json:"uid"`
	Role   string `json:"role"`
	jwt.RegisteredClaims
}

// SetSecret sets the HS256 signing key. It must be called before NewToken or ParseToken.
func SetSecret(s string) error {
	if len(s) < MinSecretLen {
		return fmt.Errorf("JWT secret must be at least %d characters", MinSecretLen)
	}
	secret = []byte(s)
	return nil
}

// NewToken returns a signed HS256 token for the user that expires in TokenTTL.
func NewToken(userID int64, role string) (string, error) {
	if secret == nil {
		return "", errors.New("auth: secret not set")
	}
	claims := Claims{
		UserID: userID,
		Role:   role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(TokenTTL)),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(secret)
}

// ParseToken verifies the signature (HS256 only, so "none" and other algorithms
// are rejected) and the expiry, and returns the claims.
func ParseToken(s string) (*Claims, error) {
	if secret == nil {
		return nil, errors.New("auth: secret not set")
	}
	var claims Claims
	_, err := jwt.ParseWithClaims(s, &claims,
		func(*jwt.Token) (any, error) { return secret, nil },
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithExpirationRequired(),
	)
	if err != nil {
		return nil, err
	}
	if claims.UserID <= 0 || claims.Role == "" {
		return nil, errors.New("auth: token missing user id or role")
	}
	return &claims, nil
}
