package myurls

const defaultBodyLimit = 16 * 1024

func normalizeBodyLimit(value int64) int64 {
	if value < 1 || value > defaultBodyLimit {
		return defaultBodyLimit
	}
	return value
}
