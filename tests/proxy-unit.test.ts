import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";

test("AGE projection lexer and lossless graph wire decoding", () => {
  // This is the one Python plugin boundary required by the upstream proxy.
  const check = spawnSync("python3", ["-c", String.raw`
import sys
sys.path.insert(0, 'connect/proxy')
from age_values import bind, returning, decode, Entity, json_safe, identity_literals
assert identity_literals('MATCH (n) WHERE ID(n) IN ["9223372036854775806", "2"] RETURN n') == 'MATCH (n) WHERE ID(n) IN [9223372036854775806, 2] RETURN n'
assert identity_literals("RETURN 'id(n) IN [\"12\"]' AS text") == "RETURN 'id(n) IN [\"12\"]' AS text"
assert identity_literals("MATCH (n) WHERE n.id IN ['12'] RETURN n") == "MATCH (n) WHERE n.id IN ['12'] RETURN n"
assert returning('MATCH (n)-[r]->(m) RETURN * LIMIT 3')[1] == ['n', 'r', 'm']
assert returning('MATCH p=(n)-[r]->(m) RETURN p LIMIT 1')[1] == ['p']
assert returning('MATCH (n) RETURN n, count(n) AS total ORDER BY total')[1] == ['n', 'total']
assert returning('RETURN {x:1,y:2} AS value, [1,2] AS xs, 2 * 3 AS product')[1] == ['value', 'xs', 'product']
assert returning("RETURN 'RETURN, LIMIT' AS text /* , RETURN z */")[1] == ['text']
assert returning('RETURN 1 AS first UNION RETURN 2 AS first')[1] == ['first']
assert returning('MATCH (n) WITH n AS x RETURN x LIMIT 2')[1] == ['x']
assert returning('MATCH (n) RETURN n.limit, n.return')[1] == ['n.limit', 'n.return']
for query in ['MATCH (n) SET n.x=1 RETURN n', 'CREATE (n:X) RETURN n', 'MATCH (n) DELETE n RETURN n', 'MATCH (n) REMOVE n.x RETURN n', 'CALL proc() RETURN 1']:
    try:
        returning(query)
        raise AssertionError('write query must be rejected')
    except ValueError as e:
        assert 'read-only' in str(e)
assert returning("RETURN 'SET n.x=1' AS text")[1] == ['text']
try:
    returning('MATCH (n) WITH n AS x RETURN *')
    raise AssertionError('ambiguous star must be rejected')
except ValueError: pass
try:
    returning('RETURN 1; RETURN 2')
    raise AssertionError('multiple statements must be rejected')
except ValueError: pass
statement = bind("RETURN $name AS value, '$name' AS unchanged // $missing", {'name': "a'\\b"})
assert '"a\'\\\\b" AS value' in statement and "'$name' AS unchanged" in statement
raw = '[{"id": 9223372036854775806, "label":"Person", "properties":{"note":"::vertex", "values":[null,true,1]}}::vertex, {"id":7,"label":"LINK","start_id":9223372036854775806,"end_id":2,"properties":{}}::edge]::path'
path = decode(raw)
assert isinstance(path, Entity) and path.kind == 'path'
assert path.value[0].value['id'] == 9223372036854775806
assert path.value[0].value['properties']['note'] == '::vertex'
assert json_safe(path.value[0].value)['id'] == '9223372036854775806'
assert decode('{"nested":[1.5::numeric, {"x": "quote\\\" inside"}]}')['nested'][0] == 1.5
assert decode('null') is None
print('projection, parameters, nested entities, exact IDs and annotation strings passed')
`], {encoding: "utf8"});
  assert.equal(check.status, 0, check.stderr || check.stdout);
});
