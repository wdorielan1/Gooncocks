"""
Storage for Trade Lab: listings, sign-in sessions, one-time login states
and cached rosters, one small record each.

Every record is (pk, sk) plus a JSON "data" blob, a "version" number and
an optional "expires" time (epoch seconds). Writes can require a version:
  expect=None  write unconditionally
  expect=0     the record must not exist yet (create)
  expect=N     the record must exist at version N (update/delete)
A write whose condition fails raises Conflict, so two managers saving at
once can never silently overwrite each other, and one listing's write
never touches another listing.

DynamoStore is the real store (one DynamoDB table with a pk/sk key and
TTL on "expires"). MemoryStore has identical rules and is used by the
tests and the offline preview.
"""
import copy
import json
import threading
import time


class Conflict(Exception):
    """A conditional write lost: the record changed (or appeared) first."""


class MemoryStore:
    def __init__(self, clock=time.time):
        self._items, self._lock, self._clock = {}, threading.Lock(), clock

    def _live(self, item):
        return item and (not item.get("expires") or item["expires"] > self._clock())

    def get(self, pk, sk):
        with self._lock:
            item = self._items.get((pk, sk))
            return copy.deepcopy(item) if self._live(item) else None

    def query(self, pk):
        with self._lock:
            return [copy.deepcopy(v) for (p, _), v in sorted(self._items.items()) if p == pk and self._live(v)]

    def put(self, pk, sk, data, version, expect=None, expires=None):
        with self._lock:
            current = self._items.get((pk, sk))
            current = current if self._live(current) else None
            _check(current, expect)
            item = {"pk": pk, "sk": sk, "data": copy.deepcopy(data), "version": version}
            if expires:
                item["expires"] = int(expires)
            self._items[(pk, sk)] = item
            return copy.deepcopy(item)

    def delete(self, pk, sk, expect=None):
        with self._lock:
            current = self._items.get((pk, sk))
            current = current if self._live(current) else None
            _check(current, expect)
            self._items.pop((pk, sk), None)
            return current


def _check(current, expect):
    if expect is None:
        return
    if expect == 0:
        if current is not None:
            raise Conflict("already exists")
    elif current is None or current.get("version") != expect:
        raise Conflict("changed since it was read")


class DynamoStore:
    """The same interface over a DynamoDB table (partition key "pk",
    sort key "sk", both strings; TTL attribute "expires")."""

    def __init__(self, table_name, table=None):
        if table is None:
            import boto3
            table = boto3.resource("dynamodb").Table(table_name)
        self.table = table

    @staticmethod
    def _decode(raw):
        if not raw:
            return None
        item = {"pk": raw["pk"], "sk": raw["sk"], "data": json.loads(raw.get("data") or "{}"),
                "version": int(raw.get("version") or 0)}
        if raw.get("expires") is not None:
            item["expires"] = int(raw["expires"])
            if item["expires"] <= time.time():
                return None  # DynamoDB deletes expired items lazily
        return item

    def get(self, pk, sk):
        return self._decode(self.table.get_item(Key={"pk": pk, "sk": sk}, ConsistentRead=True).get("Item"))

    def query(self, pk):
        from boto3.dynamodb.conditions import Key
        items, kwargs = [], {"KeyConditionExpression": Key("pk").eq(pk), "ConsistentRead": True}
        while True:
            page = self.table.query(**kwargs)
            items.extend(filter(None, (self._decode(i) for i in page.get("Items", []))))
            if "LastEvaluatedKey" not in page:
                return items
            kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]

    def _condition(self, expect):
        if expect is None:
            return {}
        if expect == 0:
            return {"ConditionExpression": "attribute_not_exists(pk)"}
        return {"ConditionExpression": "#v = :v", "ExpressionAttributeNames": {"#v": "version"},
                "ExpressionAttributeValues": {":v": expect}}

    def put(self, pk, sk, data, version, expect=None, expires=None):
        item = {"pk": pk, "sk": sk, "data": json.dumps(data, separators=(",", ":")), "version": version}
        if expires:
            item["expires"] = int(expires)
        try:
            self.table.put_item(Item=item, **self._condition(expect))
        except self.table.meta.client.exceptions.ConditionalCheckFailedException as exc:
            raise Conflict(str(exc)) from exc
        return {"pk": pk, "sk": sk, "data": data, "version": version, **({"expires": int(expires)} if expires else {})}

    def delete(self, pk, sk, expect=None):
        try:
            out = self.table.delete_item(Key={"pk": pk, "sk": sk}, ReturnValues="ALL_OLD", **self._condition(expect))
        except self.table.meta.client.exceptions.ConditionalCheckFailedException as exc:
            raise Conflict(str(exc)) from exc
        return self._decode(out.get("Attributes"))
