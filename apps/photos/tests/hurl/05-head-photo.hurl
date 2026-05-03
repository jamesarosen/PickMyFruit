# Present object (uploaded in 02-happy-path)
HEAD http://localhost:{{port}}/photos/{{photo_id}}
x-internal-token: {{token}}

HTTP 200

# Absent object (a different UUID that was never uploaded)
HEAD http://localhost:{{port}}/photos/{{absent_photo_id}}
x-internal-token: {{token}}

HTTP 404
