// Where a logged-in user lands. Admin has no page yet and uses "/" like students.
// Every role's home page must accept that role, or redirects would loop.
export function homePathFor(role) {
  switch (role) {
    case 'driver':
      return '/driver'
    default:
      return '/'
  }
}
