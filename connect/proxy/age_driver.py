"""Apache AGE drop-in driver for graphxr-database-proxy 6229afd57ef7.

Python is required by the upstream driver interface. Lifecycle and integration
tests stay in this repository's TypeScript CLI. No changes to Kineviz are needed
for clients that support the proxy's expand/pull intent endpoints.
"""
from __future__ import annotations

import os
import time
from dataclasses import replace

import psycopg
from psycopg import sql
from fastapi import HTTPException

from .age_values import Entity, bind, decode, identity_literals, json_safe, returning
from .base import BaseDatabaseDriver
from .dialect import NEO4J_DIALECT, backtick, cypher_string, numeric_id_literal
from .graph_support import GraphIntentSupport, _bolt_family_capabilities
from ..models.project import (
    Category, GraphData, GraphSchema, GraphSchemaResponse, Node, QueryData,
    QueryResponse, Relationship, RelationshipData, SampleDataResponse, SchemaResponse,
)


class AgeDriver(GraphIntentSupport, BaseDatabaseDriver):
    graph_capabilities = _bolt_family_capabilities("age")
    graph_capabilities.multiDatabase = False
    # AGE returns the actual edge endpoints. Include both nodes in every intent
    # so a fresh canvas never receives an edge without its source.
    graph_dialect = replace(NEO4J_DIALECT, name="age", return_vars=("n", "r", "m"))

    async def connect(self):
        if self._connection is not None:
            return
        password = self.config.password
        if self.config.options.get("password_env"):
            password = os.environ[self.config.options["password_env"]]
        self._connection = await psycopg.AsyncConnection.connect(
            host=self.config.host, port=self.config.port or 5432,
            dbname=self.config.database_id, user=self.config.username,
            password=password, connect_timeout=5, autocommit=True,
            sslmode="verify-full" if self.config.use_tls else "disable",
            application_name="kineviz-age-proxy",
            options="-c search_path=ag_catalog,public -c default_transaction_read_only=on -c statement_timeout=15000",
        )
        try:
            rows = await self._sql("SELECT 1 FROM ag_catalog.ag_graph WHERE name = %s", (self.config.graph_name,))
            if not rows:
                raise ValueError(f"AGE graph {self.config.graph_name!r} does not exist")
        except Exception:
            await self.disconnect()
            raise

    async def disconnect(self):
        connection, self._connection = self._connection, None
        if connection is not None:
            await connection.close()

    async def _sql(self, statement, parameters=None):
        async with self._connection.cursor() as cursor:
            await cursor.execute(statement, parameters)
            return await cursor.fetchall()

    async def test_connection(self):
        await self.connect()
        return (await self._values("RETURN 1 AS ok"))[1] == [[1]]

    async def _values(self, query, parameters=None):
        statement, columns = returning(identity_literals(bind(query, parameters or {})))
        definitions = sql.SQL(", ").join(sql.SQL("{} agtype").format(sql.Identifier(f"c{i}")) for i in range(len(columns)))
        # AGE requires a dollar-quoted query (an ordinary SQL string is rejected).
        # Choose a delimiter absent from the entire query, including parameters,
        # so user text can never terminate the literal and break out into SQL.
        tag = "$age_query$"
        while tag in statement:
            tag = tag[:-1] + "_$"
        command = sql.SQL("SELECT * FROM ag_catalog.cypher({}, {}) AS ({}) LIMIT 20001").format(
            sql.Literal(self.config.graph_name), sql.SQL(tag + statement + tag), definitions,
        )
        rows = await self._sql(command)
        if len(rows) > 20000:
            raise ValueError("Result exceeds 20,000 rows; add a smaller Cypher LIMIT")
        return columns, [[decode(v) if v is not None else None for v in row] for row in rows]

    async def execute_query(self, query, parameters=None):
        started = time.monotonic()
        try:
            await self.connect()
            columns, rows = await self._values(query, parameters)
            nodes, edges = {}, {}

            def visit(value):
                if isinstance(value, Entity):
                    entity = value.value
                    if value.kind == "vertex":
                        key = str(entity["id"])
                        nodes[key] = Node(id=key, labels=[entity["label"]], properties=json_safe(entity["properties"]))
                    elif value.kind == "edge":
                        key = str(entity["id"])
                        edges[key] = RelationshipData(id=key, type=entity["label"],
                            startNodeId=str(entity["start_id"]), endNodeId=str(entity["end_id"]),
                            properties=json_safe(entity["properties"]))
                    elif value.kind == "path":
                        visit(entity)
                elif isinstance(value, dict):
                    for child in value.values():
                        visit(child)
                elif isinstance(value, list):
                    for child in value:
                        visit(child)

            visit(rows)
            if nodes or edges:
                # RETURN r and collect(r) are useful graph queries too. Hydrate
                # missing endpoints so every delivered edge can render.
                missing = sorted({key for edge in edges.values() for key in (edge.startNodeId, edge.endNodeId)} - nodes.keys())
                if missing:
                    _, endpoints = await self._values("MATCH (n) WHERE id(n) IN $ids RETURN n", {"ids": [int(key) for key in missing]})
                    visit(endpoints)
                data = QueryData(type="GRAPH", data=GraphData(nodes=list(nodes.values()), relationships=list(edges.values())))
            else:
                data = QueryData(type="TABLE", data=[columns, *json_safe(rows)])
            return QueryResponse(success=True, data=data, execution_time=time.monotonic() - started)
        except Exception as exc:
            return QueryResponse(success=False, error=str(exc), execution_time=time.monotonic() - started)

    async def _run_statements(self, statements):
        # The upstream mixin skips failed QueryResponses, turning errors into
        # empty graphs. Propagate them instead; a rejection is not zero matches.
        from .intents import merge_graph_results
        results = []
        for statement in statements:
            response = await self.execute_query(statement)
            if not response.success:
                raise HTTPException(status_code=400, detail=response.error)
            results.append(response.data)
        return merge_graph_results(results)

    async def expand(self, request):
        # The generic dialect spells "both" as <-[r]->, which AGE rejects.
        # AGE's undirected pattern traverses both incoming and outgoing edges.
        if request.direction == "both":
            request = request.model_copy(update={"direction": "all"})
        if request.hops >= 1:
            if request.hops > 5:
                raise HTTPException(status_code=400, detail="Expand at most five hops per request")
            if not request.nodeIds:
                return QueryData(type="GRAPH", data=GraphData())
            ids = "[" + ",".join(numeric_id_literal(v) for v in request.nodeIds) + "]"
            node = "n:" + backtick(request.category) if request.category else "n"
            left = "<-" if request.direction == "to" else "-"
            right = "->" if request.direction == "from" else "-"
            # AGE's VLE engine avoids the enormous generic join produced by a
            # chain of unlabeled MATCH variables on a graph with many labels.
            query = f"MATCH p=({node}){left}[*1..{request.hops}]{right}(m) WHERE id(n) IN {ids}"
            if request.onlyBetweenSelected:
                query += f" AND id(m) IN {ids} AND id(n) <> id(m)"
            predicates = []
            for values, expression, negate in (
                (request.relationships, "type(e)", False),
                (request.excludeRelationshipTypes, "type(e)", True),
                (request.excludeRelationshipIds, "id(e)", True),
            ):
                if values:
                    render = numeric_id_literal if expression == "id(e)" else cypher_string
                    literals = "[" + ",".join(render(v) for v in values) + "]"
                    predicate = f"{expression} IN {literals}"
                    if negate:
                        predicate = f"NOT ({predicate})"
                    predicates.append(predicate)
            if predicates:
                # This release has no Cypher all() predicate. Group each path's
                # edges instead, retaining only paths with no rejected edge.
                query += " WITH p UNWIND relationships(p) AS e WITH p, sum(CASE WHEN "
                query += " AND ".join(f"({p})" for p in predicates)
                query += " THEN 0 ELSE 1 END) AS blocked WHERE blocked = 0"
            query += f" RETURN p SKIP {request.skip} LIMIT {min(request.limit, 20000)}"
            return await self._run_statements([query])
        return await super().expand(request)

    async def get_graph_schema(self):
        try:
            await self.connect()
            labels = await self._sql("""SELECT name, kind, id FROM ag_catalog.ag_label
                WHERE graph=(SELECT graphid FROM ag_catalog.ag_graph WHERE name=%s)
                AND name NOT IN ('_ag_label_vertex', '_ag_label_edge') ORDER BY name""", (self.config.graph_name,))
            node_labels = {int(label_id): name for name, kind, label_id in labels if kind == "v"}
            categories, relationships = [], []
            for name, kind, _ in labels:
                table = sql.Identifier(self.config.graph_name, name)
                # Properties are dynamic. Sampling is explicit and bounded;
                # labels and endpoint combinations come from the actual catalog.
                sample = await self._sql(sql.SQL("SELECT properties::text FROM ONLY {} LIMIT 500").format(table))
                types = {}
                for (raw,) in sample:
                    for key, value in decode(raw).items():
                        typename = "BOOLEAN" if isinstance(value, bool) else "INTEGER" if isinstance(value, int) else "FLOAT" if isinstance(value, float) else "STRING" if isinstance(value, str) else "LIST" if isinstance(value, list) else "MAP" if isinstance(value, dict) else "NULL"
                        types[key] = typename if key not in types or types[key] in (typename, "NULL") else "ANY"
                metadata = dict(name=name, props=sorted(types), propsTypes=types, keys=[], keysTypes={})
                if kind == "v":
                    categories.append(Category(**metadata))
                else:
                    pairs = await self._sql(sql.SQL("SELECT DISTINCT (start_id::text::bigint >> 48), (end_id::text::bigint >> 48) FROM ONLY {}").format(table))
                    for start, end in pairs:
                        relationships.append(Relationship(**metadata, startCategory=node_labels.get(start, ""), endCategory=node_labels.get(end, "")))
            schema = GraphSchema(categories=categories, relationships=relationships)
            self.remember_graph_categories({c.name: c.model_dump() for c in categories})
            return GraphSchemaResponse(success=True, data=schema)
        except Exception as exc:
            return GraphSchemaResponse(success=False, error=str(exc))

    async def get_schema(self):
        schema = await self.get_graph_schema()
        return SchemaResponse(success=schema.success, error=schema.error,
            data={c.name: c.propsTypes for c in schema.data.categories} if schema.success else None)

    async def get_sample_data(self):
        try:
            _, rows = await self._values("MATCH (n) RETURN properties(n) AS properties LIMIT 10")
            return SampleDataResponse(success=True, data={"nodes": json_safe(rows)})
        except Exception as exc:
            return SampleDataResponse(success=False, error=str(exc))

    def get_api_info(self, project_name):
        base = f"/api/age/{project_name}"
        return {"type": "age", "version": "1.0", "api_urls": {name: f"{base}/{name}" for name in
            ("query", "test", "schema", "graphSchema", "capabilities", "expand", "pullCategory", "pullRelationship")}}
