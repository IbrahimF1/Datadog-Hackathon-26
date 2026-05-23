import { Octokit } from "@octokit/rest";
import { config } from "../config.js";

// OPTIONAL, read-only. Sessions perform all pushes/pulls themselves; the server
// only peeks at peer-progress to confirm everyone is in sync. Safe no-op when
// no token/repo is configured.
export class GitHubClient {
  private octokit: Octokit | null;
  private owner = "";
  private repo = "";

  constructor() {
    const { token, repo } = config.github;
    if (token && repo.includes("/")) {
      const [owner, name] = repo.split("/");
      this.owner = owner;
      this.repo = name;
      this.octokit = new Octokit({ auth: token });
    } else {
      this.octokit = null;
    }
  }

  available(): boolean {
    return this.octokit !== null;
  }

  async branchHeadSha(branch = "peer-progress"): Promise<string | null> {
    if (!this.octokit) return null;
    try {
      const res = await this.octokit.repos.getBranch({
        owner: this.owner,
        repo: this.repo,
        branch,
      });
      return res.data.commit.sha;
    } catch {
      return null;
    }
  }

  async recentCommits(branch = "peer-progress", limit = 10): Promise<string[]> {
    if (!this.octokit) return [];
    try {
      const res = await this.octokit.repos.listCommits({
        owner: this.owner,
        repo: this.repo,
        sha: branch,
        per_page: limit,
      });
      return res.data.map((c) => c.sha);
    } catch {
      return [];
    }
  }
}
