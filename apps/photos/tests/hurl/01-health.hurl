GET http://localhost:{{port}}/health

HTTP 200
[Asserts]
jsonpath "$.ok" == true
jsonpath "$.uptimeMs" isInteger
