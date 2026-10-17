// Where a logged-in user lands. Students (and unknown roles) use "/".
// Every role's home page must accept that role, or redirects would loop.
export function homePathFor(role) {
  switch (role) {
    case 'admin':
      return '/admin'
    case 'driver':
      return '/driver'
    default:
      return '/'
  }
}
