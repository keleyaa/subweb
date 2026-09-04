package shortcode

const maxLength = 64

// ValidCode reports whether value is a supported short code.
func ValidCode(value string) bool {
	if len(value) == 0 || len(value) > maxLength {
		return false
	}
	for index := 0; index < len(value); index++ {
		character := value[index]
		if (character < 'a' || character > 'z') &&
			(character < 'A' || character > 'Z') &&
			(character < '0' || character > '9') &&
			character != '_' && character != '-' {
			return false
		}
	}
	return true
}

// ValidPath reports whether path is a root-relative short-code path.
func ValidPath(path string) bool {
	return len(path) >= 2 && len(path) <= maxLength+1 && path[0] == '/' && ValidCode(path[1:])
}
