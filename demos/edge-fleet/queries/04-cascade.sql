-- Single SELECT: usable in psql and Kineviz Query > SQL.
SELECT root::text AS root, dependents::bigint AS dependents
FROM ag_catalog.cypher('edge_fleet', $$
  MATCH (upstream:Device)-[:DEPENDS_ON*1..4]->(root:Device) WITH root, count(DISTINCT upstream) AS dependents WHERE dependents >= 3 RETURN root.id, dependents ORDER BY dependents DESC
$$) AS (root agtype, dependents agtype);
