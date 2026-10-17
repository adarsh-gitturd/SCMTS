package handlers

import (
	"time"

	"scmts/backend/ranking"
)

// tripTimeContext returns the hour (0..23) and ISO weekday (1=Mon..7=Sun)
// of t in loc.
func tripTimeContext(t time.Time, loc *time.Location) (hour, isoWeekday int) {
	lt := t.In(loc)
	wd := int(lt.Weekday())
	if wd == 0 {
		wd = 7
	}
	return lt.Hour(), wd
}

// liveStatus returns the live status of bus id from the buses loaded for ranking.
func liveStatus(buses []ranking.Bus, id int64) (string, bool) {
	for _, b := range buses {
		if b.ID == id {
			return b.Status, true
		}
	}
	return "", false
}
