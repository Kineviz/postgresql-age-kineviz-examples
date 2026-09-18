-- Single SELECT: usable in psql and Kineviz Query > SQL.
SELECT device::text AS device, source::text AS source, target::text AS target
FROM ag_catalog.cypher('fraud_rings', $$
  MATCH (a:Client)-[:USED_DEVICE]->(d:Device)<-[:USED_DEVICE]-(b:Client), (a)-[:PAID]->(b) WHERE a.id <> b.id RETURN DISTINCT d.id, a.id, b.id
$$) AS (device agtype, source agtype, target agtype);
