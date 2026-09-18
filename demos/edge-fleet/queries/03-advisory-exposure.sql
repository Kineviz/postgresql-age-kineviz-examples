-- Single SELECT: usable in psql and Kineviz Query > SQL.
SELECT site::text AS site, firmware::text AS firmware, devices::bigint AS devices
FROM ag_catalog.cypher('edge_fleet', $$
  MATCH (d:Device)-[:RUNS]->(f:Firmware), (d)-[:CONNECTED_TO]->(:Gateway)-[:HOSTED_AT]->(s:Site) WHERE f.advisory = 'KEV-2026-0031' WITH s, f, count(DISTINCT d) AS devices RETURN s.name, f.version, devices ORDER BY devices DESC
$$) AS (site agtype, firmware agtype, devices agtype);
