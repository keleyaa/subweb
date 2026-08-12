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
  # 值字符类排除方括号是有意的：redact_encoded_uris/redact_uris 产出的
  # "[redacted-uri]" 占位符含方括号，若再次匹配会把占位符重写成
  # "[redacted]" 并陷入替换前后不变的死循环。含方括号的完整 URI（如
  # sub://host[1]）已由 URI 级脱敏整体覆盖；裸方括号的非 URI 片段残留
  # 属可接受的单行过滤器边界。跨行值不在范围内。
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
  gsub(/[Cc]ookie:[[:space:]]*[^[:space:]]+/, "Cookie: [redacted]", line);
  print line;
  fflush();
}
