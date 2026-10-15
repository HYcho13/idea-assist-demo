plugins { id("com.android.application") }

// AGP resolves Windows junctions back to the Unicode project path before invoking
// CMake. Build the JNI libraries separately in that case, from an ASCII cwd.
val needsAsciiNativeBuild = System.getProperty("os.name").startsWith("Windows", ignoreCase = true) &&
    rootProject.projectDir.canonicalPath.any { it.code > 127 }
val generatedNativeDir = layout.buildDirectory.dir("generated/native")

android {
    namespace = "com.ideaassist.app"
    compileSdk = 36
    ndkVersion = "28.2.13676358"
    defaultConfig {
        applicationId = "com.ideaassist.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        ndk { abiFilters += listOf("arm64-v8a", "x86_64") }
        if (!needsAsciiNativeBuild) {
            externalNativeBuild {
                cmake { arguments += listOf("-DANDROID_STL=c++_shared", "-DCMAKE_BUILD_TYPE=Release") }
            }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    if (needsAsciiNativeBuild) {
        sourceSets.getByName("main").jniLibs.srcDir(generatedNativeDir.get().asFile)
    } else {
        externalNativeBuild {
            cmake {
                path = file("src/main/cpp/CMakeLists.txt")
                version = "3.22.1"
            }
        }
    }
    buildTypes {
        release { isMinifyEnabled = false }
    }
}

if (needsAsciiNativeBuild) {
    val nativeScript = rootProject.file("../scripts/build-native.ps1")
    val sdkDirectory = androidComponents.sdkComponents.sdkDirectory
    val buildNativeAi = tasks.register<Exec>("buildNativeAi") {
        group = "build"
        description = "Build both CPU JNI ABIs from an ASCII Windows cache directory"
        inputs.file(nativeScript)
        inputs.files(fileTree("src/main/cpp") {
            include("**/*.cpp", "**/*.h", "**/*.hpp", "**/CMakeLists.txt", "**/*.cmake")
            exclude(".build-check*/**")
        })
        inputs.property("ndkVersion", "28.2.13676358")
        inputs.property("sdkDirectory", sdkDirectory.map { it.asFile.absolutePath })
        outputs.dir(generatedNativeDir)
        doFirst {
            commandLine("powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                "-File", nativeScript.absolutePath,
                "-SourceRoot", file("src/main/cpp").absolutePath,
                "-OutputRoot", generatedNativeDir.get().asFile.absolutePath,
                "-SdkRoot", sdkDirectory.get().asFile.absolutePath)
        }
    }
    tasks.matching { it.name == "preBuild" }.configureEach { dependsOn(buildNativeAi) }
}
kotlin {
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}
dependencies {
    androidTestImplementation("androidx.test:runner:1.5.2")
    androidTestImplementation("androidx.test:core:1.5.0")
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("junit:junit:4.13.2")
}
