export type AuthUser = {
  sub: string;
  role: "PASSENGER" | "OPERATOR" | "ADMIN";
  sessionId: string;
};
