-- Single SELECT: usable in psql and Kineviz Query > SQL.
SELECT collector::text AS collector, senders::bigint AS senders, amount::float8 AS amount
FROM ag_catalog.cypher('fraud_rings', $$
  MATCH (a:Client)-[p:PAID]->(b:Client) WHERE p.amount > 2000 WITH b, count(DISTINCT a) AS senders, sum(p.amount) AS amount WHERE senders >= 3 RETURN b.id, senders, amount ORDER BY amount DESC
$$) AS (collector agtype, senders agtype, amount agtype);
