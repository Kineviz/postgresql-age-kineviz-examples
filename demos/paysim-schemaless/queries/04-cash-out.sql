-- Single SELECT: usable in psql and Kineviz Query > SQL.
SELECT client::text AS client, merchant::text AS merchant, amount::float8 AS amount, isfraud::boolean AS isfraud
FROM ag_catalog.cypher('paysim', $$
  MATCH (c:client)-[:performs]->(t:transaction)-[:to_merchant]->(m:merchant) WHERE m.highrisk = true AND t.action = 'CASH_OUT' RETURN c._key, m.name, t.amount, t.isfraud ORDER BY t.amount DESC LIMIT 50
$$) AS (client agtype, merchant agtype, amount agtype, isfraud agtype);
