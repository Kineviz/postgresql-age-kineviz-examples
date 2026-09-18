"""AGE wire values and Cypher result columns; independent of the proxy runtime."""
from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from typing import Any


@dataclass
class Entity:
    kind: str
    value: Any


def decode(text: str) -> Any:
    """Decode nested agtype annotations without touching text inside strings.

    Python integers preserve AGE's 64-bit identities. They are converted to
    strings only at the graph boundary, before JavaScript can round them.
    """
    cursor = 0
    decoder = json.JSONDecoder()

    def space():
        nonlocal cursor
        while cursor < len(text) and text[cursor].isspace():
            cursor += 1

    def value():
        nonlocal cursor
        space()
        if text[cursor] == "[":
            cursor += 1
            result = []
            space()
            while text[cursor] != "]":
                result.append(value())
                space()
                if text[cursor] != ",":
                    break
                cursor += 1
            if text[cursor] != "]":
                raise ValueError("Malformed agtype array")
            cursor += 1
        elif text[cursor] == "{":
            cursor += 1
            result = {}
            space()
            while text[cursor] != "}":
                space()
                key, cursor = decoder.raw_decode(text, cursor)
                space()
                if not isinstance(key, str) or text[cursor] != ":":
                    raise ValueError("Malformed agtype object")
                cursor += 1
                result[key] = value()
                space()
                if text[cursor] != ",":
                    break
                cursor += 1
            if text[cursor] != "}":
                raise ValueError("Malformed agtype object")
            cursor += 1
        else:
            result, cursor = decoder.raw_decode(text, cursor)
        space()
        if text[cursor:cursor + 2] == "::":
            match = re.match(r"::([a-z]+)", text[cursor:])
            if not match:
                raise ValueError("Malformed agtype annotation")
            cursor += len(match[0])
            kind = match[1]
            if kind in ("vertex", "edge", "path"):
                result = Entity(kind, result)
            elif kind not in ("numeric", "integer", "float"):
                raise ValueError(f"Unsupported agtype annotation: {kind}")
        return result

    result = value()
    space()
    if cursor != len(text):
        raise ValueError("Trailing agtype content")
    return result


def json_safe(value: Any) -> Any:
    if isinstance(value, Entity):
        return json_safe(value.value)
    if isinstance(value, dict):
        return {k: json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [json_safe(v) for v in value]
    if isinstance(value, int) and not isinstance(value, bool) and abs(value) > 2**53 - 1:
        return str(value)
    if isinstance(value, float) and not math.isfinite(value):
        return str(value)
    return value


@dataclass
class Token:
    text: str
    start: int
    end: int
    depth: int


def tokens(query: str) -> list[Token]:
    """Lex strings, quoted names and comments separately from Cypher syntax."""
    pattern = re.compile(r"//[^\n]*|/\*[\s\S]*?\*/|'(?:\\.|''|[^'\\])*'|\"(?:\\.|\"\"|[^\"\\])*\"|`(?:``|[^`])*`|\$[A-Za-z_][\w]*|[A-Za-z_][\w]*|\s+|.")
    result, depth = [], 0
    for match in pattern.finditer(query):
        word = match[0]
        if word.isspace() or word.startswith(("//", "/*")):
            continue
        if word in (")", "]", "}"):
            depth -= 1
        result.append(Token(word, match.start(), match.end(), depth))
        if word in ("(", "[", "{"):
            depth += 1
    if depth != 0:
        raise ValueError("Unbalanced Cypher delimiters")
    return result


def literal(value: Any) -> str:
    if isinstance(value, dict):
        return "{" + ",".join("`" + str(k).replace("`", "``") + "`:" + literal(v) for k, v in value.items()) + "}"
    if isinstance(value, list):
        return "[" + ",".join(literal(v) for v in value) + "]"
    return json.dumps(value, ensure_ascii=False, allow_nan=False)


def bind(query: str, parameters: dict) -> str:
    # AGE only accepts its parameter map with PREPARE. Lexical substitution is
    # equivalent for this read-only bridge and never rewrites quoted strings.
    for token in reversed(tokens(query)):
        if token.text.startswith("$"):
            key = token.text[1:]
            if key not in parameters:
                raise ValueError(f"Missing query parameter: {key}")
            query = query[:token.start] + literal(parameters[key]) + query[token.end:]
    return query


def identity_literals(query: str) -> str:
    """Kineviz's generic proxy profile quotes IDs in internal-edge queries.

    AGE IDs are numeric. Normalize only literal RHS values of id(variable)
    equality/IN predicates, never property comparisons or arbitrary strings.
    """
    words = tokens(query)
    replacements = {}
    for i in range(len(words) - 5):
        if words[i].text.upper() != "ID" or [t.text for t in words[i+1:i+4:2]] != ["(", ")"]:
            continue
        if not re.fullmatch(r"[A-Za-z_]\w*|`(?:``|[^`])+`", words[i+2].text):
            continue
        operator, rhs = words[i+4], words[i+5]
        candidates = []
        if operator.text == "=":
            candidates = [rhs]
        elif operator.text.upper() == "IN" and rhs.text == "[":
            for t in words[i+6:]:
                if t.depth <= rhs.depth:
                    break
                if t.depth == rhs.depth + 1:
                    candidates.append(t)
        for t in candidates:
            if re.fullmatch(r"['\"][0-9]+['\"]", t.text):
                replacements[t.start] = (t.end, str(int(t.text[1:-1])))
    for start, (end, replacement) in sorted(replacements.items(), reverse=True):
        query = query[:start] + replacement + query[end:]
    return query


def returning(query: str) -> tuple[str, list[str]]:
    """Find explicit result columns; expand the common MATCH ... RETURN * form.

    This is a projection lexer, not a Cypher translator. AGE remains the parser.
    WITH/UNWIND + RETURN * is deliberately rejected rather than guessing scope.
    Explicit projections preserve WITH, aggregates, aliases and ORDER BY.
    """
    query = query.strip().rstrip(";").strip()
    words = tokens(query)
    # AGE 1.6 SET can update existing label rows even under a read-only session.
    # Keep database ACLs as a second layer, but reject mutation clauses before
    # execution. Strings, quoted identifiers and comments are separate tokens.
    forbidden = {"CREATE", "MERGE", "SET", "REMOVE", "DELETE", "DETACH", "DROP", "CALL", "FOREACH"}
    if any(t.text.upper() in forbidden and (i == 0 or words[i-1].text != ".") for i, t in enumerate(words)):
        raise ValueError("This proxy is read-only; mutation clauses and procedure calls are disabled")
    if any(t.text == ";" for t in words):
        raise ValueError("Send one Cypher statement per request")
    returns = [i for i, t in enumerate(words) if t.depth == 0 and t.text.upper() == "RETURN" and (i == 0 or words[i-1].text != ".")]
    if not returns:
        raise ValueError("Read-only queries must have a RETURN clause")
    # UNION result width is decided by its first projection; AGE validates the
    # remaining branches. Using the last would also lose the first aliases.
    start = returns[0] + 1
    if start < len(words) and words[start].text.upper() == "DISTINCT":
        start += 1
    stop = next((i for i in range(start, len(words)) if words[i].depth == 0 and words[i-1].text != "." and words[i].text.upper() in ("ORDER", "SKIP", "LIMIT", "UNION")), len(words))
    projection = words[start:stop]
    if not projection:
        raise ValueError("RETURN needs at least one expression")
    if len(projection) == 1 and projection[0].text == "*":
        if len(projection) != 1 or len(returns) != 1 or any(t.depth == 0 and t.text.upper() in ("WITH", "UNWIND", "CALL") for t in words[:start]):
            raise ValueError("Use explicit RETURN variables with WITH, UNWIND, CALL or UNION")
        names = []
        for i, t in enumerate(words[:start - 1]):
            if t.text in ("(", "[") and i + 1 < start - 1:
                candidate = words[i + 1].text
                if re.fullmatch(r"[A-Za-z_]\w*|`(?:``|[^`])+`", candidate) and candidate not in names:
                    names.append(candidate)
            if t.text == "=" and i and words[i - 1].depth == 0:
                candidate = words[i - 1].text
                if candidate not in names:
                    names.append(candidate)
        if not names:
            raise ValueError("Use explicit RETURN variables")
        t = projection[0]
        return returning(query[:t.start] + ", ".join(names) + query[t.end:])
    groups, begin = [], 0
    for i, t in enumerate(projection):
        if t.text == "," and t.depth == 0:
            groups.append(projection[begin:i])
            begin = i + 1
    groups.append(projection[begin:])
    columns = []
    for group in groups:
        if not group:
            raise ValueError("Empty RETURN expression")
        aliases = [i for i, t in enumerate(group) if t.depth == 0 and t.text.upper() == "AS"]
        name = group[aliases[-1] + 1].text if aliases else query[group[0].start:group[-1].end]
        columns.append(name.strip("`").replace("``", "`"))
    return query, columns
