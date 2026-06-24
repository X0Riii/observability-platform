use nom::{
    bytes::complete::take_while,
    sequence::separated_pair,
    IResult,
};
use std::borrow::Cow;

/// A parsed URL with zero-copy string slices where possible.
#[derive(Debug)]
pub struct ParsedUrl<'a> {
    pub scheme: Option<&'a str>,
    pub host: Option<&'a str>,
    pub port: Option<u16>,
    pub path: &'a str,
    pub query: Option<&'a str>,
    pub fragment: Option<&'a str>,
    pub query_count: usize,
    pub query_pairs: Vec<(&'a str, &'a str)>,
}

impl<'a> ParsedUrl<'a> {
    pub fn from_str(url: &'a str) -> Self {
        let mut result = ParsedUrl {
            scheme: None,
            host: None,
            port: None,
            path: "",
            query: None,
            fragment: None,
            query_count: 0,
            query_pairs: Vec::new(),
        };

        let after_scheme = if let Some((s, rest)) = url.split_once("://") {
            result.scheme = Some(s);
            rest
        } else {
            url
        };

        // Find the start of path (first '/' after host)
        let path_start = after_scheme.find('/').unwrap_or(after_scheme.len());
        let host_part = &after_scheme[..path_start];
        let full_path = &after_scheme[path_start..];

        if let Some((host, port_str)) = host_part.split_once(':') {
            result.host = Some(host);
            result.port = port_str.parse::<u16>().ok();
        } else {
            result.host = Some(host_part);
        }

        result.path = full_path;

        if let Some((path, fragment)) = full_path.split_once('#') {
            result.path = path;
            result.fragment = Some(fragment);
        }

        if let Some((path, query)) = result.path.split_once('?') {
            result.path = path;
            result.query = Some(query);
            result.query_count = query.split('&').count();
            for pair in query.split('&') {
                if let Some((k, v)) = pair.split_once('=') {
                    result.query_pairs.push((k, v));
                }
            }
        }

        result
    }

    pub fn hostname(&self) -> Cow<'a, str> {
        self.host.map(Cow::Borrowed).unwrap_or(Cow::Owned("".into()))
    }
}

/// Parse a HAR-style header line: "Key: Value"
pub fn parse_header_line(input: &str) -> IResult<&str, (&str, &str)> {
    use nom::Parser;
    separated_pair(
        take_while(|c: char| c != ':' && !c.is_control()),
        nom::bytes::complete::tag(": "),
        take_while(|c: char| c != '\r' && c != '\n'),
    )
    .parse(input)
}

/// Parse a comma-separated list of values (e.g., Accept-Encoding: gzip, deflate)
pub fn parse_comma_list(input: &str) -> Vec<&str> {
    input.split(',').map(|s| s.trim()).collect()
}

/// Parse Content-Type header to extract MIME type and optional charset
pub fn parse_content_type(input: &str) -> (&str, Option<&str>) {
    if let Some((mime, rest)) = input.split_once(';') {
        let charset = rest
            .split(';')
            .find_map(|p| {
                let p = p.trim();
                p.strip_prefix("charset=")
            });
        (mime.trim(), charset)
    } else {
        (input.trim(), None)
    }
}

/// Zero-copy parse a URL-encoded query string into pairs
pub fn parse_query_string(input: &str) -> Vec<(&str, &str)> {
    input
        .split('&')
        .filter_map(|pair| {
            let mut parts = pair.splitn(2, '=');
            match (parts.next(), parts.next()) {
                (Some(k), Some(v)) => Some((k, v)),
                _ => None,
            }
        })
        .collect()
}

/// Parse HTTP status line: "HTTP/1.1 200 OK"
pub fn parse_status_line(input: &str) -> IResult<&str, u16> {
    use nom::Parser;
    let (input, _) = nom::bytes::complete::take_while(|c: char| c != ' ').parse(input)?;
    let (input, _) = nom::character::complete::space1.parse(input)?;
    nom::character::complete::u16.parse(input)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_url_full() {
        let url = ParsedUrl::from_str("https://www.google.com/search?q=observability&hl=en#results");
        assert_eq!(url.scheme, Some("https"));
        assert_eq!(url.host, Some("www.google.com"));
        assert_eq!(url.path, "/search");
        assert_eq!(url.query_count, 2);
        assert_eq!(url.query_pairs[0], ("q", "observability"));
        assert_eq!(url.fragment, Some("results"));
    }

    #[test]
    fn test_parse_url_no_scheme() {
        let url = ParsedUrl::from_str("example.com/path");
        assert_eq!(url.scheme, None);
        assert_eq!(url.host, Some("example.com"));
        assert_eq!(url.path, "/path");
    }

    #[test]
    fn test_parse_content_type() {
        let (mime, charset) = parse_content_type("text/html; charset=utf-8");
        assert_eq!(mime, "text/html");
        assert_eq!(charset, Some("utf-8"));
    }

    #[test]
    fn test_parse_comma_list() {
        let result = parse_comma_list("gzip, deflate, br");
        assert_eq!(result, vec!["gzip", "deflate", "br"]);
    }

    #[test]
    fn test_parse_query_string() {
        let pairs = parse_query_string("q=rust&page=1&format=json");
        assert_eq!(pairs.len(), 3);
        assert_eq!(pairs[0], ("q", "rust"));
    }
}
