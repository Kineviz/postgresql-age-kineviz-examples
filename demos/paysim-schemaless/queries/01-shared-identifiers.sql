-- Single SELECT: usable in psql and Kineviz Query > SQL.
SELECT kind::text AS kind, identifier::text AS identifier, accounts::bigint AS accounts
FROM ag_catalog.cypher('paysim', $$
  MATCH (c:client)-[identity]->(i) WHERE type(identity) IN ['has_ssn', 'has_email', 'has_phone'] WITH i, count(DISTINCT c) AS accounts WHERE accounts > 1 RETURN label(i), i.name, accounts ORDER BY accounts DESC
$$) AS (kind agtype, identifier agtype, accounts agtype);
