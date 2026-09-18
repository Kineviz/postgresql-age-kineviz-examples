-- Single SELECT: usable in psql and Kineviz Query > SQL.
SELECT collector::text AS collector, name::text AS name, senders::bigint AS senders, amount::float8 AS amount
FROM ag_catalog.cypher('paysim', $$
  MATCH (a:client)-[:performs]->(t:transaction)-[:to_client]->(b:client) WHERE t.amount > 2000 WITH b, count(DISTINCT a) AS senders, sum(t.amount) AS amount WHERE senders >= 3 RETURN b._key, b.name, senders, amount ORDER BY amount DESC LIMIT 20
$$) AS (collector agtype, name agtype, senders agtype, amount agtype);
