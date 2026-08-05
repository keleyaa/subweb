function redact_uris(text, match_text, replacement) {
  while (match(text, /[[:alpha:]][[:alnum:]+.-]*:\/\/[^[:space:]'"<>]+/)) {
    match_text = substr(text, RSTART, RLENGTH);
    replacement = "[redacted-uri]";
    text = substr(text, 1, RSTART - 1) replacement substr(text, RSTART + RLENGTH);
  }
  return text;
}

function redact_encoded_uris(text, match_text, replacement) {
  while (match(text, /[[:alpha:]][[:alnum:]+.-]*%3[Aa]%2[Ff]%2[Ff][^[:space:]'"<>]+/)) {
    match_text = substr(text, RSTART, RLENGTH);
    replacement = "[redacted-uri]";
    text = substr(text, 1, RSTART - 1) replacement substr(text, RSTART + RLENGTH);
  }
  return text;
}

function redact_request_sources(text, match_text, equals, prefix) {
  while (match(text, /(^|[?&[:space:]])(url|link|subscription|subscription_url|sub_url|source)=[^[:space:]'"<>\[\]]+/)) {
    match_text = substr(text, RSTART, RLENGTH);
    equals = index(match_text, "=");
    prefix = substr(match_text, 1, equals);
    text = substr(text, 1, RSTART - 1) prefix "[redacted]" substr(text, RSTART + RLENGTH);
  }
  return text;
}

{
  line = redact_encoded_uris($0);
  line = redact_uris(line);
  line = redact_request_sources(line);
  gsub(/[Aa]uthorization:[[:space:]]*[^[:space:]]+([[:space:]]+[^[:space:]]+)?/, "Authorization: [redacted]", line);
  gsub(/[Pp]roxy-[Aa]uthorization:[[:space:]]*[^[:space:]]+([[:space:]]+[^[:space:]]+)?/, "Proxy-Authorization: [redacted]", line);
  print line;
  fflush();
}
