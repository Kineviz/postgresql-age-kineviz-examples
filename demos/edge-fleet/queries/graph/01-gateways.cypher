MATCH p=(d:Device)-[:CONNECTED_TO]->(g:Gateway)
RETURN p
LIMIT 100
