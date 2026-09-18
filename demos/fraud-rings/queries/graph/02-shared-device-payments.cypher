MATCH p=(a:Client)-[:USED_DEVICE]->(d:Device)<-[:USED_DEVICE]-(b:Client),
      q=(a)-[:PAID]->(b)
WHERE a.id <> b.id
RETURN p, q
LIMIT 100
