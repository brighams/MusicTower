if [ ! -d "SteamFetch" ]; then
  git clone https://github.com/AFCMS/SteamFetch
fi

if ! dotnet --version > /dev/null 2>&1; then
  echo "Warning: dotnet is not installed or not in PATH"
fi

cd SteamFetch
dotnet publish -c Release -o ./bin
