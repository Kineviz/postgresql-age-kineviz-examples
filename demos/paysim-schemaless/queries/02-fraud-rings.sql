-- Single SELECT: usable in psql and Kineviz Query > SQL.
SELECT source::text AS source, target::text AS target, identifier::text AS identifier, amount::float8 AS amount
FROM ag_catalog.cypher('paysim', $$
  MATCH (a:client)-[left_identity]->(i)<-[right_identity]-(b:client), (a)-[:performs]->(t:transaction)-[:to_client]->(b) WHERE type(left_identity) IN ['has_ssn', 'has_email', 'has_phone'] AND type(right_identity) IN ['has_ssn', 'has_email', 'has_phone'] AND a._key <> b._key RETURN DISTINCT a._key, b._key, i.name, t.amount
$$) AS (source agtype, target agtype, identifier agtype, amount agtype);
