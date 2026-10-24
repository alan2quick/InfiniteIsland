export function releaseRepository(environment = process.env) {
  const repository = environment.ISLAND_RELEASE_REPOSITORY || 'alan2quick/InfiniteIsland';
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Set ISLAND_RELEASE_REPOSITORY to owner/repository.');
  return repository;
}
