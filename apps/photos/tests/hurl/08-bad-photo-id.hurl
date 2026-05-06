POST http://localhost:{{port}}/transform/not-a-valid-uuid
x-internal-token: {{token}}
Content-Type: image/jpeg
file,apps/photos/tests/fixtures/sample.jpg;

HTTP 400
[Asserts]
jsonpath "$.error" == "invalid_photo_id"
