POST http://localhost:{{port}}/transform/{{other_photo_id}}
x-internal-token: {{token}}
Content-Type: image/jpeg
file,apps/photos/tests/fixtures/oversized.bin;

HTTP 413
[Asserts]
jsonpath "$.error" == "payload_too_large"
