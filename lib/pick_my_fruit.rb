require 'sinatra'
require 'haml'

class PickMyFruit < Sinatra::Base
  set :root, File.expand_path('..', File.dirname(__FILE__))
  

  get '/' do
    haml :index
  end
end
