-- Map source_id -> target_id; relationship supplies the edge label.
SELECT source_id::text AS source_id, source_label::text AS source_label, source_name::text AS source_name, target_id::text AS target_id, target_label::text AS target_label, target_name::text AS target_name, relationship::text AS relationship, edge_id::text AS edge_id, (amount::text)::numeric AS amount
FROM ag_catalog.cypher('fraud_rings', $$
  MATCH (s:Client)-[p:PAID]->(b:Client) WHERE p.amount > 2000 WITH b, count(DISTINCT s) AS n WHERE n >= 3 MATCH (a:Client)-[r:PAID]->(b) WHERE r.amount > 2000 RETURN DISTINCT a._key, label(a), coalesce(a.name, a.id, a._key), b._key, label(b), coalesce(b.name, b.id, b._key), type(r), r._key, coalesce(r.amount, a.amount, b.amount, 0) LIMIT 500
$$) AS (source_id agtype, source_label agtype, source_name agtype, target_id agtype, target_label agtype, target_name agtype, relationship agtype, edge_id agtype, amount agtype);
