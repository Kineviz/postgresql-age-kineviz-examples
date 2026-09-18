-- Single SELECT: usable in psql and Kineviz Query > SQL.
SELECT device::text AS device, accounts::bigint AS accounts
FROM ag_catalog.cypher('fraud_rings', $$
  MATCH (c:Client)-[:USED_DEVICE]->(d:Device) WITH d, count(DISTINCT c) AS accounts WHERE accounts > 1 RETURN d.id, accounts ORDER BY accounts DESC
$$) AS (device agtype, accounts agtype);
