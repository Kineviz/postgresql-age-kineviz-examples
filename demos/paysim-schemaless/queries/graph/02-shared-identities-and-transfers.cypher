MATCH p=(a:client)-[left_identity]->(i)<-[right_identity]-(b:client),
      q=(a)-[:performs]->(:transaction)-[:to_client]->(b)
WHERE type(left_identity) IN ['has_ssn', 'has_email', 'has_phone']
  AND type(right_identity) IN ['has_ssn', 'has_email', 'has_phone']
  AND a._key <> b._key
RETURN p, q
LIMIT 100
