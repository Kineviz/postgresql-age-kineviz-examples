-- Single SELECT: usable in psql and Kineviz Query > SQL.
SELECT site::text AS site, critical_devices::bigint AS critical_devices
FROM ag_catalog.cypher('edge_fleet', $$
  MATCH (t:Technician)-[:COVERS]->(s:Site) WITH s, count(DISTINCT t) AS technicians WHERE technicians = 1 MATCH (d:Device)-[:CONNECTED_TO]->(:Gateway)-[:HOSTED_AT]->(s) WHERE d.criticality = 'high' WITH s, count(DISTINCT d) AS critical_devices RETURN s.name, critical_devices ORDER BY critical_devices DESC
$$) AS (site agtype, critical_devices agtype);
