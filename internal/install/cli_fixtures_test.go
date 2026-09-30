package install

// Synthetic descriptors exercise shared CLI installation without shipping retired integrations.
const exampleOptionKey = "example"
const exampleRegistryPackage = "@test/example"
const examplePackage = exampleRegistryPackage + "@latest"
const runtimeCLIOptionKey = "runtimecli"
const runtimeCLIRegistryPackage = "@test/runtimecli"
const runtimeCLIPackage = runtimeCLIRegistryPackage + "@latest"
const runtimeCLIMinimumNodeVersion = "20.19.0"

var exampleGlobalCLI = globalCLIDescriptor{optionKey: exampleOptionKey, displayName: "Example", registryPackage: exampleRegistryPackage, installSpec: examplePackage, executable: "example", versionArgs: []string{"--version"}}
var runtimeCLIGlobalCLI = globalCLIDescriptor{optionKey: runtimeCLIOptionKey, displayName: "RuntimeCLI", registryPackage: runtimeCLIRegistryPackage, installSpec: runtimeCLIPackage, executable: "runtimecli", versionArgs: []string{"--version"}, minimumNodeVersion: runtimeCLIMinimumNodeVersion}
