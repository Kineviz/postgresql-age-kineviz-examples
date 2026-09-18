MATCH p=(d:Device)-[:DEPENDS_ON*1..4]->(root:Device)
RETURN p
LIMIT 100
