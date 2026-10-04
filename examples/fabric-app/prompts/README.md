# The prompts, exactly as sent

These are the prompts behind the article *Building Fabric Apps with an AI agent: 5 prompts, 2 MCP servers*, byte for
byte as they were sent to the agent (Claude Code, on Claude Sonnet 5.5) over the model in this folder. Each file holds
one prompt per turn, separated by a line of `=====`.

| File | What it is |
| --- | --- |
| `with-regiabi.txt` | The four build prompts with the RegiaBI chart server. The only differences from `standard-route.txt` are the sentence "Use the RegiaBI charts server for the charts." in prompt 2 and the workspace name. |
| `standard-route.txt` | The same four prompts with no chart server: Microsoft's data app template and its agent skills only. |
| `standard-route-chart-types-named.txt` | The standard route again, with one more sentence in prompt 2 naming the three chart types. |
| `second-chance-with-regiabi.txt` | The follow-up prompts the RegiaBI app got after its first build. |
| `second-chance-standard-route.txt` | The follow-up prompts the standard-route app got after its first build. |

After the four build prompts, each app got one more: "Deploy it to the *workspace* workspace in Fabric." After its
second chance, "Deploy the updated app to the *workspace* workspace in Fabric." Each app had a workspace of its own
(Global Revenue Apps, Global Revenue Demo and Global Revenue Gate), each holding a copy of this semantic model.

Before the first prompt, the chart server was added once, by hand, from its listing in the MCP Registry:

```text
claude mcp add --scope project bic-chart -- npx -y @bicharts/chart-mcp
```

## SHA-256

```text
7fceca3ea233b561e32f141978423970336942f4f027ef67428660cdf3bc3acf second-chance-standard-route.txt
21eb84151cffee00dd1b7941920f0f5d401e1e1b5f7b343800622abb30d22963 second-chance-with-regiabi.txt
8bf05188a865171a7decfd694fae21c48b581bf85bb740aadae31e468e1bccc0 standard-route-chart-types-named.txt
75e43fe14b78b293c2577a860ef82e8386c1f2d8c7195e88a542a5137b3e7354 standard-route.txt
702bf69d16c6f06deab33c9969c7eee72f0cb71925e126e6cd30a4bb3fcd7e56 with-regiabi.txt
```

To replay the build you need a Fabric capacity (a trial works), the Fabric Apps tenant settings applied, and, for the
RegiaBI arm, a RegiaBI license to author charts. What will differ, even with the same prompts: the page's layout, the
agent's code and questions, and, on your own data, the charts the server offers.
