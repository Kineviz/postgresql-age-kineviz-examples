-- Single SELECT: usable in psql and Kineviz Query > SQL.
SELECT client::text AS client, merchant::text AS merchant, amount::float8 AS amount
FROM ag_catalog.cypher('fraud_rings', $$
  MATCH (c:Client)-[p:PAID_MERCHANT]->(m:Merchant) WHERE p.amount > 5000 RETURN c.id, m.name, p.amount
$$) AS (client agtype, merchant agtype, amount agtype);
