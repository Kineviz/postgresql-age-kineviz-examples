-- Single SELECT: usable in psql and Kineviz Query > SQL.
SELECT gateway::text AS gateway, site::text AS site, devices::bigint AS devices
FROM ag_catalog.cypher('edge_fleet', $$
  MATCH (d:Device)-[:CONNECTED_TO]->(g:Gateway)-[:HOSTED_AT]->(s:Site) WITH g, s, count(d) AS devices RETURN g.id, s.name, devices ORDER BY devices DESC LIMIT 10
$$) AS (gateway agtype, site agtype, devices agtype);
