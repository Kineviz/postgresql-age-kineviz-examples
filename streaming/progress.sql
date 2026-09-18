SELECT transactions::bigint AS transactions, planted_fraud::bigint AS planted_fraud
FROM ag_catalog.cypher('paysim_stream', $$
  MATCH (t:transaction)
  RETURN count(t), sum(CASE WHEN t.isfraud THEN 1 ELSE 0 END)
$$) AS (transactions agtype, planted_fraud agtype);
