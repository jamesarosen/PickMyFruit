# Missing token
POST http://localhost:{{port}}/transform/{{photo_id}}
Content-Type: image/jpeg
file,apps/photos/tests/fixtures/sample.jpg;

HTTP 401
[Asserts]
jsonpath "$.error" == "unauthorized"

# Wrong token
POST http://localhost:{{port}}/transform/{{photo_id}}
x-internal-token: wrong-token
Content-Type: image/jpeg
file,apps/photos/tests/fixtures/sample.jpg;

HTTP 401
[Asserts]
jsonpath "$.error" == "unauthorized"
