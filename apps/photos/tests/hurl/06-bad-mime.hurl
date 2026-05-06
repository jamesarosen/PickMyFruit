POST http://localhost:{{port}}/transform/{{other_photo_id}}
x-internal-token: {{token}}
Content-Type: text/plain
`hello, this is not an image`

HTTP 415
[Asserts]
jsonpath "$.error" == "unsupported_media_type"
