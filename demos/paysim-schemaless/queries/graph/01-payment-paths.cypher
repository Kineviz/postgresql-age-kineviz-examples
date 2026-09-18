MATCH p=(c:client)-[:performs]->(t:transaction)-[destination]->(recipient)
RETURN p
LIMIT 100
