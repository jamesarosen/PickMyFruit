POST http://localhost:{{port}}/transform/{{photo_id}}
x-internal-token: {{token}}
Content-Type: image/jpeg
[Body]
file,apps/photos/tests/fixtures/sample.jpg;

HTTP 200
[Asserts]
jsonpath "$.key" == "pub/{{photo_id}}.jpg"
jsonpath "$.cached" == true
jsonpath "$.coldStart" == false
jsonpath "$.bytes" isInteger
