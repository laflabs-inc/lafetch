import { lafetch } from "../src/index.js";

interface User {
  id: string;
  name: string;
}

const api = lafetch.create({
  baseUrl: "https://api.example.com",
});

const user = await api
  .get<User>("/users/123")
  .timeout("3s")
  .retry(3)
  .as("json");

console.log(user.name);
